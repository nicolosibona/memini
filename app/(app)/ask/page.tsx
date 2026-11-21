import { redirect } from "next/navigation";

// Asking now happens in the chat on the Home page.
export default function AskPage() {
  redirect("/");
}
