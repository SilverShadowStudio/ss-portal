import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const { task_id } = await req.json()
    if (!task_id) return new Response(JSON.stringify({ error: 'task_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    // Get task with account info
    const { data: task } = await supabase
      .from('lane_tasks')
      .select('id, title, account_id, notification_sent_at')
      .eq('id', task_id)
      .single()

    if (!task) return new Response(JSON.stringify({ error: 'Task not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    if (task.notification_sent_at) return new Response(JSON.stringify({ message: 'Already notified' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    // Get account members' emails
    const { data: members } = await supabase
      .from('account_members')
      .select('user_id')
      .eq('account_id', task.account_id)

    const userIds = (members || []).map((m: any) => m.user_id)

    const { data: users } = await supabase.auth.admin.listUsers()
    const emails = (users?.users || [])
      .filter((u: any) => userIds.includes(u.id))
      .map((u: any) => u.email)
      .filter(Boolean)

    // Send email to each member
    for (const email of emails) {
      await supabase.functions.invoke('send-transactional-email', {
        body: {
          template_name: 'delivery_ready',
          recipient_email: email,
          template_variables: {
            task_title: task.title,
            app_url: Deno.env.get('SITE_URL') || 'https://ss-portal.vercel.app',
          },
        },
      })
    }

    // Mark notification sent
    await supabase
      .from('lane_tasks')
      .update({ notification_sent_at: new Date().toISOString() })
      .eq('id', task_id)

    return new Response(JSON.stringify({ success: true, notified: emails.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
