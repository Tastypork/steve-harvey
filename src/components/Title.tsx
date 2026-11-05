import { useAssets } from '../assets';

export function Title({ compact = false }: { compact?: boolean }) {
  const { logo } = useAssets();
  return (
    <header className={`title ${compact ? 'is-compact' : ''}`}>
      <h1 className="logo" aria-label="Wells Fargo Family Fued">
        {logo ? <img className="logo-brand" src={logo} alt="" /> : null}
        <span className="logo-ribbon">Wells Fargo</span>
        <span className="logo-word">Family Fued</span>
      </h1>
    </header>
  );
}
