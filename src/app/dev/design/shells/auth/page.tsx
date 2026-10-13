import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/ui/auth-shell";
import { TextField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";

export default function AuthShellPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AuthShell brandHref="/dev/design">
    <PageHeader title="Anmelden" description="Melde dich an und arbeite an deinem Programm weiter." />
    <form style={{ display: "grid", gap: "var(--space-4)" }}>
      <TextField label="E-Mail-Adresse" type="email" autoComplete="email" />
      <TextField label="Passwort" type="password" autoComplete="current-password" />
      <Button type="button" block>Anmelden</Button>
    </form>
  </AuthShell>;
}
