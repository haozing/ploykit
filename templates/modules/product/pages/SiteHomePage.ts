export default function SiteHomePage(props?: { data?: { headline?: string; status?: string } }) {
  return {
    view: '__MODULE_ID__.site',
    headline: props?.data?.headline ?? '__MODULE_NAME__',
    status: props?.data?.status ?? 'ready',
  };
}
