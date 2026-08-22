import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';

const DistributionWorkspace = lazy(
  () => import('../domains/distribution/DistributionWorkspace.lazy')
);

export function GlobalDistribution() {
  const { t } = useTranslation('distribution');

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <h1 className="page-title mb-1 text-foreground">
        {t('globalTitle')}
      </h1>
      <p className="text-xs text-muted-foreground mb-3">
        {t('globalSubtitle')}
      </p>
      <Suspense fallback={null}>
        <DistributionWorkspace scope="global" />
      </Suspense>
    </div>
  );
}
