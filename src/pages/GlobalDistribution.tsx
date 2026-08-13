import { useTranslation } from 'react-i18next';
import { DistributionWorkspace } from '../components/DistributionWorkspace';

export function GlobalDistribution() {
  const { t } = useTranslation('distribution');

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <h1 className="text-2xl font-bold text-foreground mb-1">
        {t('globalTitle')}
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        {t('globalSubtitle')}
      </p>
      <DistributionWorkspace scope="global" />
    </div>
  );
}
