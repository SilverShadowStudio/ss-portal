// Anthropic Messages API — streamed responses, reassembled.
//
// Used where a reply should appear as it is written. The reassembled content
// array must match what the non-streaming API returns block for block, because
// callers store it and replay it as the wire format on later turns.

// deno-lint-ignore no-explicit-any
type Any = any;

export type StreamEvent = { kind: "text"; text: string } | { kind: "tool"; name: string; input: Any };
export type Completion = { content: Any[]; stop_reason: string | null; usage: Any };
export type StreamFailure = { err: string; retryable: boolean; emitted: boolean };

/** Read Anthropic's event stream and rebuild exactly the content array the
 *  non-streaming API would have returned — the stored blocks are replayed as
 *  the wire format on later turns, so this has to be faithful, citations and
 *  server-tool blocks included. Text and finished tool calls are surfaced to
 *  `on` as they happen. */
export async function readStream(body: ReadableStream<Uint8Array>, on?: (e: StreamEvent) => void): Promise<Completion | StreamFailure> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  const blocks: Any[] = [];
  const partialJson: Record<number, string> = {};
  let stop_reason: string | null = null;
  let usage: Any = {};
  let emitted = false;
  let buf = "";

  const handle = (ev: Any): { err: string; retryable: boolean } | null => {
    switch (ev?.type) {
      case "message_start":
        usage = { ...(ev.message?.usage ?? {}) };
        break;
      case "content_block_start": {
        const b = { ...ev.content_block };
        if (b.type === "tool_use" || b.type === "server_tool_use") partialJson[ev.index] = "";
        blocks[ev.index] = b;
        break;
      }
      case "content_block_delta": {
        const b = blocks[ev.index];
        const d = ev.delta ?? {};
        if (!b) break;
        if (d.type === "text_delta") {
          b.text = (b.text ?? "") + (d.text ?? "");
          if (d.text) { emitted = true; on?.({ kind: "text", text: d.text }); }
        } else if (d.type === "input_json_delta") {
          partialJson[ev.index] = (partialJson[ev.index] ?? "") + (d.partial_json ?? "");
        } else if (d.type === "citations_delta") {
          (b.citations ??= []).push(d.citation);
        } else if (d.type === "thinking_delta") {
          b.thinking = (b.thinking ?? "") + (d.thinking ?? "");
        } else if (d.type === "signature_delta") {
          b.signature = d.signature;
        }
        break;
      }
      case "content_block_stop": {
        const b = blocks[ev.index];
        if (!b) break;
        if (ev.index in partialJson) {
          const raw = partialJson[ev.index];
          try { b.input = raw ? JSON.parse(raw) : {}; } catch { b.input = {}; }
          delete partialJson[ev.index];
          emitted = true;
          on?.({ kind: "tool", name: String(b.name), input: b.input });
        }
        if (b.type === "text" && b.citations == null) delete b.citations;
        break;
      }
      case "message_delta":
        if (ev.delta?.stop_reason) stop_reason = ev.delta.stop_reason;
        usage = { ...usage, ...(ev.usage ?? {}) };
        break;
      case "error":
        return {
          err: `${ev.error?.type ?? "error"}: ${String(ev.error?.message ?? "").slice(0, 200)}`,
          retryable: ["overloaded_error", "api_error", "rate_limit_error"].includes(ev.error?.type),
        };
    }
    return null;
  };

  for (;;) {
    const { value, done } = await reader.read();
    // Normalise line endings on the whole buffer, not per chunk: a chunk can end
    // between the \r and the \n, and a per-chunk replace then merges two events.
    if (value) buf = (buf + dec.decode(value, { stream: true })).replace(/\r\n/g, "\n");
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!data) continue;
      let ev: Any;
      try { ev = JSON.parse(data); } catch { continue; }
      const bad = handle(ev);
      if (bad) { reader.cancel().catch(() => {}); return { ...bad, emitted }; }
    }
    if (done) break;
  }
  if (!stop_reason) return { err: "the reply stream ended early", retryable: true, emitted };
  return { content: blocks.filter(Boolean), stop_reason, usage };
}
