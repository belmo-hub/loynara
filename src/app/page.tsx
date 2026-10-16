import { redirect } from "next/navigation";

// The app origin has no landing page: the public website is a separate site. Everyone starts at the sign-in.
export default function Home() {
  redirect("/login");
}
