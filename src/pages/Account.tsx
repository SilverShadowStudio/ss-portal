import { useState, useEffect } from "react";
import { ClientLayout } from "@/components/ClientLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { TeamManagement } from "@/components/account/TeamManagement";
import { AccordionHeader, AccordionPanel } from "@/components/ui/SectionAccordion";
import { cn } from "@/lib/utils";
import { logActivity } from "@/lib/activityLog";

interface ProfileData {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  position: string;
}

interface NotificationPrefs {
  notifyNewRoundDelivered: boolean;
  notifyFeedbackReminder: boolean;
  notifyNewReviewItem: boolean;
  notifyDailySummary: boolean;
}

export default function Account() {
  const { user, accountType } = useAuth();
  const [loading, setLoading] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  // Accordion — only one section open at a time. Null until the first data
  // load picks the default section based on the priorities below.
  type SectionKey = "profile" | "notifications" | "team" | "password";
  const [openSection, setOpenSection] = useState<SectionKey | null>(null);
  const [defaultPicked, setDefaultPicked] = useState(false);

  const toggleSection = (key: SectionKey) =>
    setOpenSection((cur) => (cur === key ? null : key));
  
  const [profile, setProfile] = useState<ProfileData>({
    firstName: "",
    lastName: "",
    email: "",
    company: "",
    position: ""
  });
  
  const [notifications, setNotifications] = useState<NotificationPrefs>({
    notifyNewRoundDelivered: false,
    notifyFeedbackReminder: false,
    notifyNewReviewItem: false,
    notifyDailySummary: false
  });

  useEffect(() => {
    async function fetchData() {
      if (!user) return;

      try {
        // Fetch profile + account company name in parallel
        const [{ data: profileData }, { data: memberData }] = await Promise.all([
          supabase
            .from("profiles")
            .select("first_name, last_name, company, position")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase
            .from("account_members")
            .select("accounts(company_name)")
            .eq("user_id", user.id)
            .maybeSingle(),
        ]);

        const accountCompany = (memberData as any)?.accounts?.company_name || "";
        setProfile({
          firstName: profileData?.first_name || "",
          lastName: profileData?.last_name || "",
          email: user.email || "",
          company: profileData?.company || accountCompany,
          position: profileData?.position || ""
        });

        // Fetch notification preferences
        const { data: notifData } = await supabase
          .from("notification_preferences")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();

        if (notifData) {
          setNotifications({
            notifyNewRoundDelivered: notifData.notify_new_round_delivered,
            notifyFeedbackReminder: notifData.notify_feedback_reminder,
            notifyNewReviewItem: notifData.notify_new_review_item,
            notifyDailySummary: notifData.notify_daily_summary
          });
        }
      } catch (error) {
        console.error("Error fetching account data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [user]);

  const handleProfileChange = (field: keyof ProfileData, value: string) => {
    setProfile(prev => ({ ...prev, [field]: value }));
  };

  const handleNotificationChange = (field: keyof NotificationPrefs, value: boolean) => {
    setNotifications(prev => ({ ...prev, [field]: value }));
  };

  // Pick the initial open section the first time data settles. Priority:
  // never-set-password → password; else → profile. The "never set" signal
  // relies on `user_metadata.password_set === false`; if absent we fall
  // through to profile, which is the common case for returning clients.
  useEffect(() => {
    if (defaultPicked || loading) return;
    const neverSetPassword = (user as any)?.user_metadata?.password_set === false;
    setOpenSection(neverSetPassword ? "password" : "profile");
    setDefaultPicked(true);
  }, [defaultPicked, loading, user]);

  // Autosave: persist profile + notifications whenever they change (after initial load)
  useEffect(() => {
    if (!user || loading) return;
    const handle = setTimeout(async () => {
      try {
        await supabase.from("profiles").upsert({
          user_id: user.id,
          first_name: profile.firstName.trim() || null,
          last_name: profile.lastName.trim() || null,
          full_name: [profile.firstName.trim(), profile.lastName.trim()].filter(Boolean).join(" ") || null,
          company: profile.company.trim() || null,
          position: profile.position.trim() || null,
        }, { onConflict: "user_id" });

        if (profile.email && profile.email !== user.email) {
          await supabase.auth.updateUser({ email: profile.email.trim() });
        }

        await supabase.from("notification_preferences").upsert({
          user_id: user.id,
          notify_new_round_delivered: notifications.notifyNewRoundDelivered,
          notify_feedback_reminder: notifications.notifyFeedbackReminder,
          notify_new_review_item: notifications.notifyNewReviewItem,
          notify_daily_summary: notifications.notifyDailySummary,
        }, { onConflict: "user_id" });
      } catch (error: any) {
        console.error("Autosave error:", error);
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [profile, notifications, user, loading]);

  if (loading) {
    return (
      <ClientLayout>
        <div className="flex items-center justify-center py-20">
          <span className="text-muted-foreground">Loading...</span>
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      {/* Header */}
      <div className="mb-12 animate-fade-in">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-px w-10 bg-gold-muted" />
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-gold font-sans">Settings</span>
        </div>
        <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl">
          ACCOUNT
        </h1>
      </div>

      <div className="max-w-2xl animate-fade-in" style={{ animationDelay: "0.1s" }}>
        {/* Profile Section */}
        <section className={cn(openSection === "profile" ? "mb-12" : "mb-6")}>
          <AccordionHeader
            label="Profile"
            isOpen={openSection === "profile"}
            onToggle={() => toggleSection("profile")}
          />
          <AccordionPanel isOpen={openSection === "profile"}>
          <div className="card-elevated p-6 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="firstName" className="text-xs uppercase tracking-wider text-muted-foreground">
                First Name
              </Label>
              <Input
                id="firstName"
                value={profile.firstName}
                onChange={(e) => handleProfileChange("firstName", e.target.value)}
                placeholder="First name"
                className="rounded-none border-0 border-b border-[hsl(32_10%_22%)] bg-transparent px-0 focus-visible:ring-0 focus-visible:border-gold"
                maxLength={100}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastName" className="text-xs uppercase tracking-wider text-muted-foreground">
                Last Name
              </Label>
              <Input
                id="lastName"
                value={profile.lastName}
                onChange={(e) => handleProfileChange("lastName", e.target.value)}
                placeholder="Last name"
                className="rounded-none border-0 border-b border-[hsl(32_10%_22%)] bg-transparent px-0 focus-visible:ring-0 focus-visible:border-gold"
                maxLength={100}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="company" className="text-xs uppercase tracking-wider text-muted-foreground">
                Company
              </Label>
              <Input
                id="company"
                value={profile.company}
                onChange={(e) => handleProfileChange("company", e.target.value)}
                placeholder="Your company name"
                className="rounded-none border-0 border-b border-[hsl(32_10%_22%)] bg-transparent px-0 focus-visible:ring-0 focus-visible:border-gold"
                maxLength={100}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={profile.email}
                onChange={(e) => handleProfileChange("email", e.target.value)}
                placeholder="your@email.com"
                className="rounded-none border-0 border-b border-[hsl(32_10%_22%)] bg-transparent px-0 focus-visible:ring-0 focus-visible:border-gold"
                maxLength={255}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="position" className="text-xs uppercase tracking-wider text-muted-foreground">
                Position
              </Label>
              <Input
                id="position"
                value={profile.position}
                onChange={(e) => handleProfileChange("position", e.target.value)}
                placeholder="Your role or title"
                className="rounded-none border-0 border-b border-[hsl(32_10%_22%)] bg-transparent px-0 focus-visible:ring-0 focus-visible:border-gold"
                maxLength={100}
              />
            </div>
          </div>
          </AccordionPanel>
        </section>

        {/* Notification Preferences Section */}
        <section className={cn(openSection === "notifications" ? "mb-12" : "mb-6")}>
          <AccordionHeader
            label="Notification Preferences"
            isOpen={openSection === "notifications"}
            onToggle={() => toggleSection("notifications")}
          />
          <AccordionPanel isOpen={openSection === "notifications"}>
          <div className="card-elevated p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-foreground">New round delivered</p>
                <p className="text-xs text-muted-foreground">
                  Receive an email when a new round is delivered
                </p>
              </div>
              <Switch
                checked={notifications.notifyNewRoundDelivered}
                onCheckedChange={(checked) => handleNotificationChange("notifyNewRoundDelivered", checked)}
              />
            </div>

            <div className="h-px bg-border" />

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-foreground">Feedback reminders</p>
                <p className="text-xs text-muted-foreground">
                  Receive reminders before a feedback window closes
                </p>
              </div>
              <Switch
                checked={notifications.notifyFeedbackReminder}
                onCheckedChange={(checked) => handleNotificationChange("notifyFeedbackReminder", checked)}
              />
            </div>

            <div className="h-px bg-border" />

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-foreground">New review items</p>
                <p className="text-xs text-muted-foreground">
                  Receive an email every time a new item is for your review
                </p>
              </div>
              <Switch
                checked={notifications.notifyNewReviewItem}
                onCheckedChange={(checked) => handleNotificationChange("notifyNewReviewItem", checked)}
              />
            </div>

            <div className="h-px bg-border" />

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-foreground">Daily summary</p>
                <p className="text-xs text-muted-foreground">
                  Receive a single daily email at 9am summarising all items pending your review
                </p>
              </div>
              <Switch
                checked={notifications.notifyDailySummary}
                onCheckedChange={(checked) => handleNotificationChange("notifyDailySummary", checked)}
              />
            </div>
          </div>
          </AccordionPanel>
        </section>

        {/* Team Management Section — only for team accounts */}
        {accountType === "team" && (
          <section className={cn(openSection === "team" ? "mb-12" : "mb-6")}>
            <AccordionHeader
              label="Team Management"
              isOpen={openSection === "team"}
              onToggle={() => toggleSection("team")}
            />
            <AccordionPanel isOpen={openSection === "team"}>
              <TeamManagement />
            </AccordionPanel>
          </section>
        )}

        {/* Change Password Section */}
        <section className={cn(openSection === "password" ? "mb-12" : "mb-6", "last:mb-0")}>
          <AccordionHeader
            label="Change Password"
            isOpen={openSection === "password"}
            onToggle={() => toggleSection("password")}
          />
          <AccordionPanel isOpen={openSection === "password"}>
          <div className="card-elevated p-6 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="currentPassword" className="text-xs uppercase tracking-wider text-muted-foreground">
                Current Password
              </Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter your current password"
                className="rounded-none border-0 border-b border-[hsl(32_10%_22%)] bg-transparent px-0 focus-visible:ring-0 focus-visible:border-gold"
                autoComplete="current-password"
                maxLength={128}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword" className="text-xs uppercase tracking-wider text-muted-foreground">
                New Password
              </Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="rounded-none border-0 border-b border-[hsl(32_10%_22%)] bg-transparent px-0 focus-visible:ring-0 focus-visible:border-gold"
                autoComplete="new-password"
                maxLength={128}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-xs uppercase tracking-wider text-muted-foreground">
                Confirm New Password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                className="rounded-none border-0 border-b border-[hsl(32_10%_22%)] bg-transparent px-0 focus-visible:ring-0 focus-visible:border-gold"
                autoComplete="new-password"
                maxLength={128}
              />
            </div>

            <Button
              onClick={async () => {
                if (!currentPassword) {
                  toast.error("Please enter your current password");
                  return;
                }
                if (newPassword.length < 8) {
                  toast.error("Password must be at least 8 characters");
                  return;
                }
                if (newPassword !== confirmPassword) {
                  toast.error("Passwords do not match");
                  return;
                }
                setChangingPassword(true);
                try {
                  // Verify current password by re-authenticating
                  const { error: signInError } = await supabase.auth.signInWithPassword({
                    email: user!.email!,
                    password: currentPassword,
                  });
                  if (signInError) {
                    toast.error("Current password is incorrect");
                    return;
                  }
                  const { error } = await supabase.auth.updateUser({ password: newPassword });
                  if (error) throw error;
                  await logActivity({ action: "password_set", description: "Changed password" });
                  toast.success("Password updated successfully");
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                } catch (error: any) {
                  console.error("Error changing password:", error);
                  toast.error(error.message || "Failed to change password");
                } finally {
                  setChangingPassword(false);
                }
              }}
              disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
              variant="outline"
              className="w-full"
            >
              {changingPassword ? "UPDATING..." : "UPDATE PASSWORD"}
            </Button>
          </div>
          </AccordionPanel>
        </section>
      </div>
    </ClientLayout>
  );
}
