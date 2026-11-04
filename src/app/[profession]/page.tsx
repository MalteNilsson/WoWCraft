import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProfessionGuide, professionGuides } from '@/lib/professionGuides';
import ProfessionPlanner from './ProfessionPlanner';

type ProfessionPageProps = {
  params: Promise<{ profession: string }>;
};

export function generateStaticParams() {
  return professionGuides.map((guide) => ({ profession: guide.slug }));
}

export async function generateMetadata({ params }: ProfessionPageProps): Promise<Metadata> {
  const { profession } = await params;
  const guide = getProfessionGuide(profession);
  if (!guide) {
    return { title: 'Profession not found' };
  }
  return {
    title: `${guide.name} Leveling Planner | WoWCraft`,
    description: guide.metaDescription,
  };
}

function PlannerFallback() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-neutral-950 text-sm text-neutral-400">
      Loading planner…
    </div>
  );
}

export default async function ProfessionPage({ params }: ProfessionPageProps) {
  const { profession } = await params;
  const guide = getProfessionGuide(profession);
  if (!guide) {
    notFound();
  }

  return (
    <div className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-neutral-950">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-[18%] top-[-14rem] h-[28rem] w-[42rem] rounded-full bg-[#e3b056]/[0.08] blur-3xl" />
        <div className="absolute right-[-6rem] top-24 h-80 w-80 rounded-full bg-[#1fb5f7]/10 blur-3xl" />
      </div>
      <Suspense fallback={<PlannerFallback />}>
        <ProfessionPlanner />
      </Suspense>
    </div>
  );
}
