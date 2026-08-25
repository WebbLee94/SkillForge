import type { SceneDetail } from '../../types';

interface SceneDetailHeaderProps {
  readonly sceneDetail: SceneDetail;
  readonly updatedAtLabel: string;
  readonly readOnlyLabel: string;
}

export function SceneDetailHeader({
  sceneDetail,
  updatedAtLabel,
  readOnlyLabel,
}: SceneDetailHeaderProps) {
  return (
    <>
      <h2 className="text-lg font-semibold text-foreground">
        {sceneDetail.scene.name}
      </h2>
      <p
        className="mt-1 text-sm text-muted-foreground"
        data-testid="scene-updated-at"
      >
        {sceneDetail.scene.description
          ? `${sceneDetail.scene.description} · `
          : ''}
        {updatedAtLabel}
      </p>
      <p
        className="text-xs text-muted-foreground"
        data-testid="scene-read-only"
      >
        {readOnlyLabel}
      </p>
    </>
  );
}
