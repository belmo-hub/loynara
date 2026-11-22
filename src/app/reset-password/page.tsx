import { ResetForm } from "./reset-form";

// ENG-286: the token comes in the link's fragment, which only the browser sees. A link with it in the query (sent before
// this change) shows the expired state: a new link is one click away.
export default function ResetPasswordPage() {
  return <ResetForm />;
}
