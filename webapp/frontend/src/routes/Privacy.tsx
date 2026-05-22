import { PageTopbar } from "../components/PageTopbar";

export function Privacy() {
  return (
    <div className="page-shell">
      <PageTopbar crumbs={[{ label: "Privacy", current: true }]} />
      <main className="page">
        <h1>Privacy policy</h1>
      </main>
    </div>
  );
}
