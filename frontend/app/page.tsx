import ConnectedDashboard from '@/components/ConnectedDashboard';
import CloudDashboard from '@/components/CloudDashboard';
import './connected.css';
export default function Home() {
  return process.env.NEXT_PUBLIC_AIDLEDGER_MODE === 'cloud' ? <CloudDashboard/> : <ConnectedDashboard/>;
}
