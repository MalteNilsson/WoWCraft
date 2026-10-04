import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProfessionGuide, professionGuides } from '@/lib/professionGuides';
import ProfessionPlanner from './ProfessionPlanner';

type ProfessionPageProps = {
  params: Promise<{ profession: string }>;
  searchParams: Promise<{
    skill?: string;
    target?: string;
    version?: string;
    realm?: string;
    faction?: string;
  }>;
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

export default async function ProfessionPage({ params, searchParams }: ProfessionPageProps) {
  const { profession } = await params;
  const query = await searchParams;
  const guide = getProfessionGuide(profession);
  if (!guide) {
    notFound();
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-neutral-950">
      <ProfessionPlanner
        initialSearchParams={{
          skill: query.skill,
          target: query.target,
          version: query.version,
          realm: query.realm,
          faction: query.faction,
        }}
      />
    </div>
  );
}
