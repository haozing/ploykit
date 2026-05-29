export function ErrorPanel({
  status,
  code,
  message,
}: {
  status: number;
  code: string;
  message: string;
}) {
  return (
    <section className="notice error">
      <strong>{status}</strong>
      <span>{code}</span>
      <p>{message}</p>
    </section>
  );
}
