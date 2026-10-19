/**
 * Where toil's configuration will be managed from the browser (#253, item 4):
 * connections, writes, dossiers and settings, through toil's own config
 * commands. That page follows the local server, so this is its entry point
 * only, saying what will be here. The preview changes nothing, and neither
 * does this page yet. A form for the forms, pending approval.
 */

export function Settings({ preview }: { preview: boolean }) {
  return (
    <>
      <div className="view-head">
        <p className="eyebrow">Settings</p>
        <h1 tabIndex={-1}>toil's configuration</h1>
        <p className="lede">
          This page will manage what <code>toil connections</code> and <code>toil dossiers</code> manage, through toil's own commands, never by editing files.
        </p>
      </div>
      <section className="panel" aria-labelledby="coming">
        <h2 id="coming">Coming with the local app</h2>
        <ul className="rows">
          <li>
            <strong>Connections:</strong> list, add, test and set the default. Secrets go straight to the OS credential store through toil's login.
          </li>
          <li>
            <strong>Writes:</strong> turn writes on for a connection, behind the same typed-name confirmation <code>toil connections writes</code> asks for.
          </li>
          <li>
            <strong>Dossiers:</strong> create them, add repositories, link areas and set field aliases.
          </li>
          <li>
            <strong>Settings:</strong> bounds and timeout.
          </li>
        </ul>
        <p className="note">{preview ? 'The preview has no configuration to change, and nothing here changes anything.' : 'Nothing here changes anything yet.'}</p>
      </section>
    </>
  );
}
