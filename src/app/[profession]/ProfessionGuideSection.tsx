import type { ProfessionGuide } from '@/lib/professionGuides';

export function ProfessionGuideSection({ guide }: { guide: ProfessionGuide }) {
  return (
    <section className="mx-auto w-full max-w-3xl border-t border-neutral-800 px-4 py-12 sm:px-6">
      <p className="text-sm font-medium tracking-wide text-[#e3b056]">{guide.expansions}</p>
      <h1 className="mt-2 text-2xl font-bold text-white desktop-layout:text-3xl">{guide.name} leveling</h1>
      <p className="mt-4 text-base leading-relaxed text-neutral-300">{guide.lead}</p>
      <div className="mt-4 space-y-4 text-base leading-relaxed text-neutral-300">
        {guide.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <h2 className="mt-10 text-lg font-semibold text-white">Worth knowing before you craft</h2>
      <ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-relaxed text-neutral-300">
        {guide.considerations.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
