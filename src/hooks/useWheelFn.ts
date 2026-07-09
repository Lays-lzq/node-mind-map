import type { TKWheelEvent } from '@/types/KonvaEvents';

interface IWheelOptions {
    ScaleBy?: number;
    MaxScale?: number;
    MinScale?: number;
}

export function useWheel(
    stageConf: { scale: { x: number; y: number }; x: number; y: number },
    options?: IWheelOptions
) {
    const { ScaleBy = 1.03, MaxScale = 4, MinScale = 1 } = options ?? {};

    return function _wheel(e: TKWheelEvent) {
        e.evt.stopPropagation();
        e.evt.preventDefault();

        const direction = e.evt.deltaY > 0 ? -1 : 1;
        const stage = e.target.getStage()!;
        const oldScale = stageConf.scale.x;
        const pointer = stage.getPointerPosition()!;

        const mousePointTo = {
            x: (pointer.x - stage.x()) / oldScale,
            y: (pointer.y - stage.y()) / oldScale
        };
        const newScale =
            direction > 0
                ? oldScale > MaxScale
                    ? oldScale
                    : oldScale * ScaleBy
                : oldScale < MinScale
                  ? oldScale
                  : oldScale / ScaleBy;

        stageConf.scale = { x: newScale, y: newScale };
        stageConf.x = pointer.x - mousePointTo.x * newScale;
        stageConf.y = pointer.y - mousePointTo.y * newScale;
    };
}
