export default function ChunkRow({ chunk, onClick }) {
  return (
    <button
      type="button"
      className="chunk"
      onClick={() => onClick(chunk)}
      aria-label={`editar ${chunk.text_es}`}
    >
      <div className="reps">{chunk.rep_count ?? 0}</div>
      <div className="chunk-body">
        <div className="chunk-es">{chunk.text_es}</div>
        {chunk.gloss_es && <div className="chunk-gloss">{chunk.gloss_es}</div>}
      </div>
      {chunk.tags && chunk.tags.length > 0 && (
        <div className="ctag-list">
          {chunk.tags.map((t) => (
            <span key={t} className="ctag">
              {t}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
