import { Reveal } from "@/components/marketing/reveal";

type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  className?: string;
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  className = "",
}: SectionHeadingProps) {
  const alignment = align === "center" ? "mx-auto items-center text-center" : "items-start";

  return (
    <Reveal className={`flex max-w-3xl flex-col ${alignment} ${className}`}>
      <p className="inline-flex w-fit items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[#635bff]">
        <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-[#635bff] to-[#00a3c4]" aria-hidden="true" />
        {eyebrow}
      </p>
      <h2 className="mt-5 text-balance text-3xl font-semibold leading-[1.06] tracking-[-0.025em] text-[#0a2540] sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-5 max-w-2xl text-base leading-7 text-[#425466] sm:text-lg sm:leading-8">{description}</p>
      ) : null}
    </Reveal>
  );
}
