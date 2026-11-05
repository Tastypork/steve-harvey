import { hostImage, useAssets, type HostPose } from '../assets';
import { useFx } from '../ui/fx';

const POSES: HostPose[] = ['idle', 'listening', 'correct', 'incorrect'];

export function Host({ large = false }: { large?: boolean }) {
  useAssets();
  const { pose, caption } = useFx();
  return (
    <aside className={`host is-${pose} ${large ? 'is-large' : ''}`} aria-label={`Steve Harvey, ${pose}`}>
      <div className="host-spot" />
      <div className="host-figure" key={pose}>
        {POSES.map((p) => (
          <img key={p} src={hostImage(p)} alt="" className={p === pose ? 'is-on' : ''} draggable={false} />
        ))}
      </div>
      {caption ? (
        <div className="host-bubble" key={caption}>
          {caption}
        </div>
      ) : null}
      <div className="host-plate">Steve Harvey</div>
    </aside>
  );
}
