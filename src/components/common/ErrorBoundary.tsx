import React from 'react';
import { cn } from '../../lib/utils';
import i18n from '../../lib/i18n';
import { AlertTriangle, RotateCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center bg-background p-8">
          <div className="text-center max-w-md">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-error/10">
              <AlertTriangle className="h-8 w-8 text-error" />
            </div>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              {i18n.t('errors.boundaryTitle')}
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {this.state.error?.message || i18n.t('errors.boundaryFallback')}
            </p>
            <button
              className={cn(
                'inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium',
                'text-primary-foreground hover:bg-primary/90',
                'transition-colors'
              )}
              onClick={this.handleReload}
            >
              <RotateCw className="h-4 w-4" />
              {i18n.t('errors.reload')}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
