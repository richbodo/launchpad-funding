import { Link } from 'react-router-dom';
import { useDemoMode } from '@/hooks/useDemoMode';

export default function DemoModeBanner() {
  const { isDemoMode, loading } = useDemoMode();

  if (loading || !isDemoMode) return null;

  return (
    <div className="w-full bg-destructive text-destructive-foreground text-center py-2 px-4 font-bold text-lg tracking-wide z-50">
      ⚠ DEMO MODE ⚠ —{' '}
      <Link to="/demo-logins" className="underline underline-offset-2 hover:opacity-80">
        View Demo Logins
      </Link>
    </div>
  );
}
