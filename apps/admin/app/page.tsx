import { redirect } from 'next/navigation'

// The admin has no landing page of its own — the inbox is home.
export default function Home() {
  redirect('/leads')
}
