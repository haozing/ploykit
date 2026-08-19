export default function SiteHomePage(props?: { data?: { headline?: string; status?: string } }) {
  return (
    <main>
      <h1>{props?.data?.headline ?? '__MODULE_NAME__'}</h1>
      <p>Status: {props?.data?.status ?? 'ready'}</p>
    </main>
  );
}
