import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const countries = [
  { value: "United Kingdom", label: "United Kingdom", priority: true },
  { value: "Australia", label: "Australia" },
  { value: "Brazil", label: "Brazil" },
  { value: "Canada", label: "Canada" },
  { value: "China", label: "China" },
  { value: "Denmark", label: "Denmark" },
  { value: "France", label: "France" },
  { value: "Germany", label: "Germany" },
  { value: "India", label: "India" },
  { value: "Italy", label: "Italy" },
  { value: "Japan", label: "Japan" },
  { value: "Mexico", label: "Mexico" },
  { value: "Netherlands", label: "Netherlands" },
  { value: "Norway", label: "Norway" },
  { value: "Saudi Arabia", label: "Saudi Arabia" },
  { value: "Singapore", label: "Singapore" },
  { value: "Spain", label: "Spain" },
  { value: "Sweden", label: "Sweden" },
  { value: "Switzerland", label: "Switzerland" },
  { value: "United Arab Emirates", label: "United Arab Emirates" },
  { value: "United States", label: "United States" },
];

interface FormData {
  companyName: string;
  country: string;
  registrationNumber: string;
  streetName: string;
  buildingNumber: string;
  city: string;
  postcode: string;
  firstName: string;
  familyName: string;
  position: string;
  emailAddress: string;
  password: string;
}

type TouchedFields = Partial<Record<keyof FormData, boolean>>;

export default function Onboarding() {
  const location = useLocation();
  const restoredFormData = (location.state as { formData?: FormData } | null)?.formData;
  const [formData, setFormData] = useState<FormData>(
    restoredFormData ?? {
      companyName: "",
      country: "",
      registrationNumber: "",
      streetName: "",
      buildingNumber: "",
      city: "",
      postcode: "",
      firstName: "",
      familyName: "",
      position: "",
      emailAddress: "",
      password: "",
    }
  );
  const [touchedFields, setTouchedFields] = useState<TouchedFields>({});
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isFieldEmpty = (field: keyof FormData) => !formData[field].trim();
  const isPasswordTooShort = (field: keyof FormData) => field === "password" && formData.password.trim().length > 0 && formData.password.trim().length < 6;
  const isEmailInvalid = (field: keyof FormData) =>
    field === "emailAddress" && formData.emailAddress.trim().length > 0 && !EMAIL_REGEX.test(formData.emailAddress.trim());
  const showError = (field: keyof FormData) =>
    touchedFields[field] && (isFieldEmpty(field) || isPasswordTooShort(field) || isEmailInvalid(field));

  const handleBlur = (field: keyof FormData) => {
    setTouchedFields((prev) => ({ ...prev, [field]: true }));
  };

  const handleChange = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleGenerateContract = () => {
    // Validate all fields
    const requiredFields: (keyof FormData)[] = [
      "companyName",
      "country",
      "registrationNumber",
      "streetName",
      "buildingNumber",
      "city",
      "postcode",
      "firstName",
      "familyName",
      "position",
      "emailAddress",
      "password",
    ];

    // Mark all fields as touched
    const allTouched = requiredFields.reduce((acc, field) => ({ ...acc, [field]: true }), {});
    setTouchedFields(allTouched);

    const emptyFields = requiredFields.filter((field) => !formData[field].trim());

    if (emptyFields.length > 0) {
      toast({
        title: "Required Fields",
        description: "Please complete the highlighted fields to continue.",
      });
      // Scroll to the first empty field — uses the per-field name marker so we
      // always land on the first one in document order, regardless of section.
      setTimeout(() => {
        const firstField = emptyFields[0];
        const target = document.querySelector(
          `[data-field="${firstField}"]`
        ) as HTMLElement | null;
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          // Inputs have their data-field on the wrapper div; focus the inner
          // focusable child if present.
          const focusable = target.querySelector(
            "input, button, [tabindex]"
          ) as HTMLElement | null;
          (focusable ?? target).focus?.();
        }
      }, 100);
      return;
    }

    if (formData.password.trim().length < 6) {
      toast({
        title: "Password Too Short",
        description: "Your password must be at least 6 characters.",
      });
      return;
    }

    if (!EMAIL_REGEX.test(formData.emailAddress.trim())) {
      setTouchedFields((prev) => ({ ...prev, emailAddress: true }));
      toast({
        title: "Invalid Email Address",
        description: "Please enter a valid email address to continue.",
      });
      setTimeout(() => {
        const emailField = document.querySelector('input[type="email"]') as HTMLElement;
        if (emailField) {
          emailField.scrollIntoView({ behavior: "smooth", block: "center" });
          emailField.focus();
        }
      }, 100);
      return;
    }

    // Navigate to contract page with form data
    navigate("/contract", { state: { formData } });
  };

  return (
    <div className="min-h-screen bg-background px-4 py-16">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-12 animate-fade-in">
          <div className="flex items-start gap-4">
            <div className="w-1 self-stretch bg-gold" />
            <div>
              <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl">
                Client Registration
              </h1>
              <p className="mt-3 text-muted-foreground">
                Please complete the details below to generate the service agreement.
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-12 animate-fade-in" style={{ animationDelay: "0.2s" }}>
          {/* Section 01 - Company Information */}
          <div className="space-y-6">
            {/* Spacer above section header */}
            <div className="h-[60px]" />
            <div className="border-b border-border pb-2">
              <span className="text-label-gold">01 — COMPANY INFORMATION</span>
            </div>

            <div className="space-y-6">
              <div className="space-y-2" data-field="companyName">
                <label className="text-label text-muted-foreground">COMPANY NAME</label>
                <input
                  type="text"
                  value={formData.companyName}
                  onChange={(e) => handleChange("companyName", e.target.value)}
                  onBlur={() => handleBlur("companyName")}
                  className={`w-full border-0 border-b bg-transparent py-3 text-foreground focus:outline-none transition-smooth ${
                    showError("companyName")
                      ? "border-destructive focus:border-destructive"
                      : "border-border focus:border-gold"
                  }`}
                />
              </div>

              <div className="space-y-2" data-field="country">
                <label className="text-label text-muted-foreground">COUNTRY</label>
                <Select
                  value={formData.country}
                  onValueChange={(value) => handleChange("country", value)}
                >
                  <SelectTrigger
                    className={`w-full border-0 border-b bg-transparent rounded-none py-3 text-foreground focus:ring-0 transition-smooth h-auto px-0 ${
                      showError("country")
                        ? "border-destructive focus:border-destructive"
                        : "border-border focus:border-gold"
                    }`}
                  >
                    <SelectValue placeholder="Select your country" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {countries
                      .filter((c) => c.priority)
                      .map((c) => (
                        <SelectItem
                          key={c.value}
                          value={c.value}
                          className="text-foreground focus:bg-secondary focus:text-foreground cursor-pointer"
                        >
                          {c.label}
                        </SelectItem>
                      ))}
                    <SelectSeparator className="bg-border my-1" />
                    {countries
                      .filter((c) => !c.priority)
                      .map((c) => (
                        <SelectItem
                          key={c.value}
                          value={c.value}
                          className="text-foreground focus:bg-secondary focus:text-foreground cursor-pointer"
                        >
                          {c.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2" data-field="registrationNumber">
                <label className="text-label text-muted-foreground">REGISTRATION NUMBER</label>
                <input
                  type="text"
                  value={formData.registrationNumber}
                  onChange={(e) => handleChange("registrationNumber", e.target.value)}
                  onBlur={() => handleBlur("registrationNumber")}
                  className={`w-full border-0 border-b bg-transparent py-3 text-foreground focus:outline-none transition-smooth ${
                    showError("registrationNumber")
                      ? "border-destructive focus:border-destructive"
                      : "border-border focus:border-gold"
                  }`}
                />
              </div>

              <div className="space-y-2" data-field="streetName">
                <label className="text-label text-muted-foreground">STREET NAME</label>
                <input
                  type="text"
                  value={formData.streetName}
                  onChange={(e) => handleChange("streetName", e.target.value)}
                  onBlur={() => handleBlur("streetName")}
                  className={`w-full border-0 border-b bg-transparent py-3 text-foreground focus:outline-none transition-smooth ${
                    showError("streetName")
                      ? "border-destructive focus:border-destructive"
                      : "border-border focus:border-gold"
                  }`}
                />
              </div>

              <div className="space-y-2" data-field="buildingNumber">
                <label className="text-label text-muted-foreground">BUILDING NUMBER</label>
                <input
                  type="text"
                  value={formData.buildingNumber}
                  onChange={(e) => handleChange("buildingNumber", e.target.value)}
                  onBlur={() => handleBlur("buildingNumber")}
                  className={`w-full border-0 border-b bg-transparent py-3 text-foreground focus:outline-none transition-smooth ${
                    showError("buildingNumber")
                      ? "border-destructive focus:border-destructive"
                      : "border-border focus:border-gold"
                  }`}
                />
              </div>

              <div className="space-y-2" data-field="city">
                <label className="text-label text-muted-foreground">CITY</label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => handleChange("city", e.target.value)}
                  onBlur={() => handleBlur("city")}
                  className={`w-full border-0 border-b bg-transparent py-3 text-foreground focus:outline-none transition-smooth ${
                    showError("city")
                      ? "border-destructive focus:border-destructive"
                      : "border-border focus:border-gold"
                  }`}
                />
              </div>

              <div className="space-y-2" data-field="postcode">
                <label className="text-label text-muted-foreground">POSTCODE</label>
                <input
                  type="text"
                  value={formData.postcode}
                  onChange={(e) => handleChange("postcode", e.target.value)}
                  onBlur={() => handleBlur("postcode")}
                  className={`w-full border-0 border-b bg-transparent py-3 text-foreground focus:outline-none transition-smooth ${
                    showError("postcode")
                      ? "border-destructive focus:border-destructive"
                      : "border-border focus:border-gold"
                  }`}
                />
              </div>

              {/* Spacer equivalent to one field height */}
              <div className="h-[60px]" />
            </div>
          </div>

          {/* Section 02 - Contact Person */}
          <div className="space-y-6">
            {/* Spacer above section header */}
            <div className="h-[60px]" />
            <div className="border-b border-border pb-2">
              <span className="text-label-gold">02 — CONTACT PERSON</span>
            </div>

            <div className="space-y-6">
              <div className="space-y-2" data-field="firstName">
                <label className="text-label text-muted-foreground">FIRST NAME</label>
                <input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => handleChange("firstName", e.target.value)}
                  onBlur={() => handleBlur("firstName")}
                  className={`w-full border-0 border-b bg-transparent py-3 text-foreground focus:outline-none transition-smooth ${
                    showError("firstName")
                      ? "border-destructive focus:border-destructive"
                      : "border-border focus:border-gold"
                  }`}
                />
              </div>

              <div className="space-y-2" data-field="familyName">
                <label className="text-label text-muted-foreground">FAMILY NAME</label>
                <input
                  type="text"
                  value={formData.familyName}
                  onChange={(e) => handleChange("familyName", e.target.value)}
                  onBlur={() => handleBlur("familyName")}
                  className={`w-full border-0 border-b bg-transparent py-3 text-foreground focus:outline-none transition-smooth ${
                    showError("familyName")
                      ? "border-destructive focus:border-destructive"
                      : "border-border focus:border-gold"
                  }`}
                />
              </div>

              <div className="space-y-2" data-field="position">
                <label className="text-label text-muted-foreground">POSITION</label>
                <input
                  type="text"
                  value={formData.position}
                  onChange={(e) => handleChange("position", e.target.value)}
                  onBlur={() => handleBlur("position")}
                  className={`w-full border-0 border-b bg-transparent py-3 text-foreground focus:outline-none transition-smooth ${
                    showError("position")
                      ? "border-destructive focus:border-destructive"
                      : "border-border focus:border-gold"
                  }`}
                />
              </div>

              <div className="space-y-2" data-field="emailAddress">
                <label className="text-label text-muted-foreground">EMAIL ADDRESS (COMMUNICATION AND LOGIN)</label>
                <input
                  type="email"
                  value={formData.emailAddress}
                  onChange={(e) => handleChange("emailAddress", e.target.value)}
                  onBlur={() => handleBlur("emailAddress")}
                  className={`w-full border-0 border-b bg-transparent py-3 text-foreground focus:outline-none transition-smooth ${
                    showError("emailAddress")
                      ? "border-destructive focus:border-destructive"
                      : "border-border focus:border-gold"
                  }`}
                />
              </div>

              <div className="space-y-2" data-field="password">
                <label className="text-label text-muted-foreground">PASSWORD (LOGIN)</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) => handleChange("password", e.target.value)}
                    onBlur={() => handleBlur("password")}
                    className={`w-full border-0 border-b bg-transparent py-3 pr-10 text-foreground focus:outline-none transition-smooth ${
                      showError("password")
                        ? "border-destructive focus:border-destructive"
                        : "border-border focus:border-gold"
                    }`}
                  />
                  {touchedFields["password"] && isPasswordTooShort("password") && (
                    <p className="text-[11px] text-destructive mt-1 tracking-wide">
                      Minimum 6 characters required
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground transition-smooth"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Generate Contract Button */}
          <button
            onClick={handleGenerateContract}
            className="w-full bg-secondary py-4 text-sm tracking-wider text-foreground transition-smooth hover:bg-secondary/80"
          >
            GENERATE SERVICES AGREEMENT
          </button>
        </div>

        {/* Back to login */}
        <div className="mt-12 flex justify-center">
          <button
            onClick={() => navigate("/auth")}
            className="text-label-gold transition-smooth hover:opacity-80 animate-fade-in"
            style={{ animationDelay: "0.3s" }}
          >
            BACK TO LOGIN
          </button>
        </div>
      </div>
    </div>
  );
}
