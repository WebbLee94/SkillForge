import { useTranslation } from 'react-i18next';
import { DistributionWorkspace } from '../components/DistributionWorkspace';

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
      <DistributionWorkspace scope="global" />
    </div>
  );
}
