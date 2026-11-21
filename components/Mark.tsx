// The Memini seal: a vermilion chop with 印, used as the wordmark's companion and as the assistant's avatar.
export function Mark({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span className={`grid place-items-center rounded-[10px] bg-brand text-white font-[family-name:var(--font-seal)] leading-none shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_2px_6px_-2px_rgb(210_63_46/0.5)] ${size === "md" ? "size-8 text-[17px]" : "size-7 text-[15px]"}`}>印</span>
  );
}
