// Figma Plugin API script for the use_figma tool (read-only): the style values of every node of a frame,
// for the style check in pixel-diff.mjs. Set FRAME to the frame's node id, run it with use_figma, and save
// the returned JSON as <dir>/styles/<id>.json. It changes nothing in the file.
//
// use_figma cuts its output at about 20 KB, so the nodes come in parts of COUNT: when the result has a
// "next", run it again with FROM set to that number and append its nodes to the file's list.
const FRAME = 'FRAME_ID';
const FROM = 0;
const COUNT = 40;

const frame = await figma.getNodeByIdAsync(FRAME);
if (!frame || !('children' in frame)) throw new Error(`No frame ${FRAME}`);
const box = frame.absoluteBoundingBox;
const mixed = (value) => (value === figma.mixed ? null : value);
const round = (value) => (typeof value === 'number' ? Math.round(value * 100) / 100 : value);
const hex = ({ r, g, b }) =>
  `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const paints = (list) =>
  !Array.isArray(list)
    ? null
    : list
        .filter((paint) => paint.visible !== false)
        .map((paint) =>
          paint.type === 'SOLID'
            ? { type: 'SOLID', color: hex(paint.color), opacity: round(paint.opacity ?? 1) }
            : paint.type.startsWith('GRADIENT_')
              ? {
                  type: paint.type,
                  opacity: round(paint.opacity ?? 1),
                  stops: paint.gradientStops.map((stop) => ({ color: hex(stop.color), alpha: round(stop.color.a), position: round(stop.position) })),
                }
              : { type: paint.type },
        );
const nodes = [];
const walk = (node, parentOpacity) => {
  if (node.visible === false) return;
  const b = node.absoluteBoundingBox;
  const opacity = node.opacity ?? 1;
  const entry = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: b ? round(b.x - box.x) : null,
    y: b ? round(b.y - box.y) : null,
    width: round(node.width),
    height: round(node.height),
    opacity: round(opacity),
    // With every ancestor inside the frame: what the element's opacity chain has to multiply to.
    effectiveOpacity: round(parentOpacity * opacity),
    fills: 'fills' in node ? paints(mixed(node.fills)) : null,
  };
  if ('layoutSizingHorizontal' in node) entry.sizing = [node.layoutSizingHorizontal, node.layoutSizingVertical];
  if (node.layoutPositioning === 'ABSOLUTE') entry.layoutPositioning = 'ABSOLUTE';
  if (node.type === 'TEXT') {
    Object.assign(entry, {
      characters: node.characters,
      fontFamily: mixed(node.fontName)?.family ?? null,
      fontStyle: mixed(node.fontName)?.style ?? null,
      fontWeight: mixed(node.fontWeight),
      fontSize: mixed(node.fontSize),
      lineHeight: mixed(node.lineHeight),
      letterSpacing: mixed(node.letterSpacing),
      textCase: mixed(node.textCase),
    });
  } else {
    if ('cornerRadius' in node) {
      entry.radius =
        node.cornerRadius === figma.mixed
          ? [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius]
          : node.cornerRadius;
      if (node.cornerSmoothing) entry.cornerSmoothing = round(node.cornerSmoothing);
    }
    if ('strokes' in node && node.strokes.some((paint) => paint.visible !== false)) {
      entry.strokes = paints(node.strokes);
      entry.strokeAlign = node.strokeAlign;
      entry.strokeWeights =
        'strokeTopWeight' in node
          ? [node.strokeTopWeight, node.strokeRightWeight, node.strokeBottomWeight, node.strokeLeftWeight]
          : [0, 1, 2, 3].map(() => mixed(node.strokeWeight));
      if (node.dashPattern?.length) entry.dashPattern = node.dashPattern;
    }
    if ('effects' in node && node.effects.some((effect) => effect.visible !== false)) {
      entry.effects = node.effects
        .filter((effect) => effect.visible !== false)
        .map((effect) =>
          effect.type.endsWith('SHADOW')
            ? {
                type: effect.type,
                x: effect.offset.x,
                y: effect.offset.y,
                radius: effect.radius,
                spread: effect.spread ?? 0,
                color: hex(effect.color),
                alpha: round(effect.color.a),
              }
            : { type: effect.type, radius: effect.radius },
        );
    }
    if ('layoutMode' in node && node.layoutMode !== 'NONE') {
      Object.assign(entry, {
        layoutMode: node.layoutMode,
        layoutWrap: node.layoutWrap,
        primaryAxisAlignItems: node.primaryAxisAlignItems,
        counterAxisAlignItems: node.counterAxisAlignItems,
        itemSpacing: node.itemSpacing,
        padding: [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft],
        strokesIncludedInLayout: node.strokesIncludedInLayout ?? false,
      });
    }
  }
  // Leave out what is empty or the default, so the file stays small.
  for (const [key, value] of Object.entries(entry)) {
    if (value === null || (['opacity', 'effectiveOpacity'].includes(key) && value === 1) || (Array.isArray(value) && !value.length)) {
      delete entry[key];
    }
  }
  nodes.push(entry);
  if ('children' in node) node.children.forEach((child) => walk(child, parentOpacity * opacity));
};
frame.children.forEach((child) => walk(child, 1));
const next = FROM + COUNT < nodes.length ? FROM + COUNT : null;
return { frame: frame.id, name: frame.name, width: frame.width, height: frame.height, total: nodes.length, next, nodes: nodes.slice(FROM, FROM + COUNT) };
