import { redirect } from "next/navigation";

// The simulator was retired once the real 微信客服 bot went live; old links land on the bot page.
export default function SimPage() {
  redirect("/wechat");
}
