export default function ToolPage() {
  return (
    <main>
      <h1>Tool Template</h1>
      <form>
        <label htmlFor="tool-input">Input</label>
        <textarea id="tool-input" name="input" />
        <button type="submit">Run</button>
      </form>
    </main>
  );
}
