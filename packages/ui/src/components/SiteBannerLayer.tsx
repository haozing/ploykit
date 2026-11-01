
import { SiteBanner } from './SiteBanner';
import { useSiteConfig } from '@ploykit/hooks';
import { useT } from '../i18n';

export interface SiteBannerLayerProps {

  maintenanceText?: string;
}

export function SiteBannerLayer({
  maintenanceText,
}: SiteBannerLayerProps = {}) {
  const t = useT();
  const { data } = useSiteConfig();
  if (!data) return null;
  return (
    <>
      {data.maintenance_mode === '1' && (
        <SiteBanner
          text={maintenanceText ?? t('ui.siteBanner.maintenance')}
          kind="warn"
        />
      )}
      <SiteBanner
        text={data.banner_text}
        kind={data.banner_kind === 'warn' ? 'warn' : 'info'}
      />
    </>
  );
}
