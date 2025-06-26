import { redirect } from 'next/navigation';

export default function HomePage({
  searchParams,
}: {
  searchParams: { skill?: string };
}) {
  const skillParam = searchParams.skill;
  const redirectUrl = skillParam ? `/enchanting?skill=${skillParam}` : '/enchanting';
  redirect(redirectUrl);
}