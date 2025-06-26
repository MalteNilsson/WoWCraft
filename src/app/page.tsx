import { redirect } from 'next/navigation';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ skill?: string }>;
}) {
  const params = await searchParams;
  const skillParam = params.skill;
  const redirectUrl = skillParam ? `/enchanting?skill=${skillParam}` : '/enchanting';
  redirect(redirectUrl);
}