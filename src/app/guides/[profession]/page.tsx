import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdSlot, AD_SLOT_LEADERBOARD } from '@/components/AdSlot';
import { ArticleLayout } from '@/components/ArticleLayout';
import { getProfessionGuide, professionGuides } from '@/lib/professionGuides';

type GuidePageProps = {
  params: Promise<{ profession: string }>;
};

export function generateStaticParams() {
  return professionGuides.map((guide) => ({ profession: guide.slug }));
}

export async function generateMetadata({ params }: GuidePageProps): Promise<Metadata> {
  const { profession } = await params;
  const guide = getProfessionGuide(profession);
  if (!guide) return { title: 'Guide not found' };
  return {
    title: `${guide.name} Leveling Guide | WoWCraft`,
    description: guide.metaDescription,
  };
}

export default async function ProfessionGuidePage({ params }: GuidePageProps) {
  const { profession } = await params;
  const guide = getProfessionGuide(profession);
  if (!guide) notFound();

  return (
    <ArticleLayout>
      <p className="text-sm font-medium tracking-wide text-[#e3b056]">{guide.expansions}</p>
      <h1 className="mt-2 text-3xl font-bold text-white desktop-layout:text-4xl">{guide.name}</h1>
      <p className="mt-4 max-w-3xl text-base leading-relaxed text-neutral-300">{guide.lead}</p>
      <div className="my-8 hidden w-full min-h-[60px] max-h-[120px] items-center justify-center min-[1920px]:flex">
        <AdSlot
          slot={AD_SLOT_LEADERBOARD}
          width={728}
          height={90}
          className="flex h-[90px] w-[728px] max-w-full items-center justify-center"
        />
      </div>
      <div className="max-w-3xl space-y-4 text-base leading-relaxed text-neutral-300">
        {guide.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <h2 className="mt-10 text-lg font-semibold text-white">Worth knowing before you craft</h2>
      <ul className="mt-4 max-w-3xl list-disc space-y-3 pl-5 text-sm leading-relaxed text-neutral-300">
        {guide.considerations.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <Link
        href={`/${guide.slug}`}
        className="mt-10 inline-flex rounded-lg bg-[#e3b056] px-4 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-[#e3b056]/90"
      >
        Open the {guide.name} planner
      </Link>
    </ArticleLayout>
  );
}
