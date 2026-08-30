export const PROJECT_FILE_FORMAT = 'luma-image-studio';
export const PROJECT_FILE_VERSION = 1;

export function moveLayerById(layers, id, direction) {
  const index = layers.findIndex((layer) => layer.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= layers.length) return layers;
  const next = [...layers];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function cropFractions(item) {
  return {
    left: item.cropLeft ?? item.cropX ?? 0,
    right: item.cropRight ?? item.cropX ?? 0,
    top: item.cropTop ?? item.cropY ?? 0,
    bottom: item.cropBottom ?? item.cropY ?? 0,
  };
}

export function cropPatch(item, box) {
  const old = cropFractions(item);
  const visibleWidth = Math.max(1, item.width);
  const visibleHeight = Math.max(1, item.height);
  const leftRatio = Math.max(0, Math.min(.98, (box.x - item.x) / visibleWidth));
  const topRatio = Math.max(0, Math.min(.98, (box.y - item.y) / visibleHeight));
  const rightRatio = Math.max(0, Math.min(.98, (item.x + item.width - box.x - box.width) / visibleWidth));
  const bottomRatio = Math.max(0, Math.min(.98, (item.y + item.height - box.y - box.height) / visibleHeight));
  const sourceWidth = Math.max(.01, 1 - old.left - old.right);
  const sourceHeight = Math.max(.01, 1 - old.top - old.bottom);
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    cropLeft: old.left + sourceWidth * leftRatio,
    cropRight: old.right + sourceWidth * rightRatio,
    cropTop: old.top + sourceHeight * topRatio,
    cropBottom: old.bottom + sourceHeight * bottomRatio,
    cropX: 0,
    cropY: 0,
  };
}

export function isProject(value) {
  return Boolean(value && typeof value === 'object' && typeof value.name === 'string' &&
    Array.isArray(value.layers) && value.layers.every((layer) =>
      layer && typeof layer.id === 'string' && ['image', 'text', 'shape'].includes(layer.type)));
}

export function isProjectFile(value) {
  return Boolean(value && value.format === PROJECT_FILE_FORMAT && value.version === PROJECT_FILE_VERSION && isProject(value.project));
}
