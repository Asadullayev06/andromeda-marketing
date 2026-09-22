import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('UI error', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="fatal-error"><AlertTriangle size={34} /><h2>Unable to display this page</h2><p>{this.state.error.message}</p><Button onClick={() => location.reload()}>Reload</Button></div>;
  }
}
