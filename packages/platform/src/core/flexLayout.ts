import { isDev } from './config.js';
import { type ElementNode } from './elementNode.js';
import { isTextNode } from './utils.js';

/**
 * A node's padding as `[top, right, bottom, left]`, the CSS order flex layout
 * and the box a parent reserves for its children use.
 */
export function paddingOf(node: ElementNode): [number, number, number, number] {
  const padding = node.padding;
  return [
    node.paddingTop ?? getArrayValue(padding, 0),
    node.paddingRight ?? getArrayValue(padding, 1),
    node.paddingBottom ?? getArrayValue(padding, 2),
    node.paddingLeft ?? getArrayValue(padding, 3),
  ];
}

function getArrayValue(
  val: number | number[] | undefined,
  index: number,
  defaultValue: number = 0,
): number {
  if (val === undefined) return defaultValue;
  if (typeof val === 'number') return val;

  const len = val.length;
  let result;
  if (len === 2) {
    result = index % 2 === 0 ? val[0] : val[1];
  } else if (len === 3) {
    result = index === 0 ? val[0] : index === 2 ? val[2] : val[1];
  } else {
    result = val[index];
  }
  return result ?? defaultValue;
}

export default function (node: ElementNode): boolean {
  const direction = node.flexDirection || 'row';
  const isRow = direction === 'row' || direction === 'row-reverse';
  const isReverse =
    direction === 'row-reverse' || direction === 'column-reverse';
  const dimension = isRow ? 'width' : 'height';
  const crossDimension = isRow ? 'height' : 'width';

  // padding order: Top, Right, Bottom, Left
  const nodePadding = node.padding;
  const paddingTop = node.paddingTop ?? getArrayValue(nodePadding, 0);
  const paddingRight = node.paddingRight ?? getArrayValue(nodePadding, 1);
  const paddingBottom = node.paddingBottom ?? getArrayValue(nodePadding, 2);
  const paddingLeft = node.paddingLeft ?? getArrayValue(nodePadding, 3);

  const paddingStart = isRow ? paddingLeft : paddingTop;
  const paddingEnd = isRow ? paddingRight : paddingBottom;
  const paddingCrossStart = isRow ? paddingTop : paddingLeft;
  const paddingCrossEnd = isRow ? paddingBottom : paddingRight;
  const nodePaddingTotal = paddingStart + paddingEnd;

  const minDimension = isRow ? 'minWidth' : 'minHeight';
  const crossMinDimension = isRow ? 'minHeight' : 'minWidth';

  const children = node.children;
  const numChildren = children.length;

  if (numChildren === 0) {
    return false;
  }

  // Optimize arrays caching
  const processableChildrenIndices: number[] = [];
  let hasOrder = false;
  let totalFlexGrow = 0;
  let totalFlexShrink = 0;

  for (let i = 0; i < numChildren; i++) {
    const c = children[i]!;

    if (isTextNode(c) || c.flexItem === false) {
      continue;
    }

    if (c.flexOrder !== undefined) {
      hasOrder = true;
    }

    const flexGrow = c.flexGrow;
    if (flexGrow !== undefined && flexGrow > 0) {
      totalFlexGrow += flexGrow;
    }

    const flexShrink = c.flexShrink;
    if (flexShrink !== undefined && flexShrink > 0) {
      totalFlexShrink += flexShrink;
    }

    if (c[minDimension] && (c[dimension] || 0) < c[minDimension]) {
      c[dimension] = c[minDimension]!;
    }

    if (
      c[crossMinDimension] &&
      (c[crossDimension] || 0) < c[crossMinDimension]
    ) {
      c[crossDimension] = c[crossMinDimension]!;
    }

    processableChildrenIndices.push(i);
  }

  if (hasOrder) {
    processableChildrenIndices.sort((aIdx, bIdx) => {
      const a = children[aIdx] as ElementNode;
      const b = children[bIdx] as ElementNode;
      return (a.flexOrder || 0) - (b.flexOrder || 0);
    });
  }

  // Apply reverse layout ordering
  if (isReverse || node.direction === 'rtl') {
    processableChildrenIndices.reverse();
  }

  const numProcessedChildren = processableChildrenIndices.length;
  if (numProcessedChildren === 0) {
    return false;
  }

  const prop = isRow ? 'x' : 'y';
  const crossProp = isRow ? 'y' : 'x';
  const containerSize = Math.max(
    node[dimension] || 0,
    node[minDimension] || 0,
    0,
  );
  let containerCrossSize = Math.max(
    node[crossDimension] || 0,
    node[crossMinDimension] || 0,
    0,
  );
  const isWrapReverse = node.flexWrap === 'wrap-reverse';
  const gap = node.gap || 0;
  const justify = node.justifyContent || 'flexStart';
  let align = node.alignItems || (node.flexWrap ? 'flexStart' : undefined);
  let containerUpdated = false;

  // Resolve sizes matching old processed calculation
  const childMainSizes = new Float32Array(numProcessedChildren);
  const childMarginStarts = new Float32Array(numProcessedChildren);
  const childMarginEnds = new Float32Array(numProcessedChildren);
  const childTotalMainSizes = new Float32Array(numProcessedChildren);
  const childCrossSizes = new Float32Array(numProcessedChildren);
  const childMarginCrossStarts = new Float32Array(numProcessedChildren);
  const childMarginCrossEnds = new Float32Array(numProcessedChildren);

  let sumOfFlexBaseSizesWithMargins = 0;
  // Set when a child still carries a size that an earlier grow/shrink wrote.
  let resized: Uint8Array | undefined;

  for (let idx = 0; idx < numProcessedChildren; idx++) {
    const c = children[processableChildrenIndices[idx]!] as ElementNode;
    const marginArray = c.margin;
    // index mappings for margins: Top: 0, Right: 1, Bottom: 2, Left: 3
    // if row: main = left/right (3/1),
    const flexBasis = c.flexBasis;
    const isBasisAuto = flexBasis === undefined || flexBasis === 'auto';
    let ownSize = c[dimension] || 0;
    if (c._flexSized !== undefined) {
      if (ownSize === c._flexSized) {
        // Unchanged since flex sized it: lay out from the item's own size, so
        // a grown item gives space back when a sibling grows.
        ownSize = c._flexBase!;
        resized ??= new Uint8Array(numProcessedChildren);
      } else {
        // The app resized it; that is the new own size.
        c._flexSized = c._flexBase = undefined;
      }
    }
    const computedBasis = isBasisAuto ? ownSize : (flexBasis as number);
    const baseMainSize = isBasisAuto
      ? computedBasis
      : Math.max(computedBasis, c[minDimension] || 0);

    const marginStart = isRow
      ? c.marginLeft || getArrayValue(marginArray, 3)
      : c.marginTop || getArrayValue(marginArray, 0);
    const marginEnd = isRow
      ? c.marginRight || getArrayValue(marginArray, 1)
      : c.marginBottom || getArrayValue(marginArray, 2);
    const marginCrossStart = isRow
      ? c.marginTop || getArrayValue(marginArray, 0)
      : c.marginLeft || getArrayValue(marginArray, 3);
    const marginCrossEnd = isRow
      ? c.marginBottom || getArrayValue(marginArray, 2)
      : c.marginRight || getArrayValue(marginArray, 1);

    childMainSizes[idx] = baseMainSize;
    childMarginStarts[idx] = marginStart;
    childMarginEnds[idx] = marginEnd;
    childTotalMainSizes[idx] = baseMainSize + marginStart + marginEnd;
    childCrossSizes[idx] = c[crossDimension] || 0;
    childMarginCrossStarts[idx] = marginCrossStart;
    childMarginCrossEnds[idx] = marginCrossEnd;

    sumOfFlexBaseSizesWithMargins += childTotalMainSizes[idx]!;
  }

  if ((totalFlexGrow > 0 || totalFlexShrink > 0) && numProcessedChildren > 1) {
    node.flexBoundary = node.flexBoundary || 'fixed';

    const totalGapSpace =
      numProcessedChildren > 0 ? gap * (numProcessedChildren - 1) : 0;
    const availableSpace =
      containerSize -
      nodePaddingTotal -
      sumOfFlexBaseSizesWithMargins -
      totalGapSpace;

    if (availableSpace > 0 && totalFlexGrow > 0) {
      for (let idx = 0; idx < numProcessedChildren; idx++) {
        const c = children[processableChildrenIndices[idx]!] as ElementNode;
        const flexGrowValue = c.flexGrow || 0;
        if (flexGrowValue > 0) {
          const shareOfSpace = (flexGrowValue / totalFlexGrow) * availableSpace;
          const newMainSize = childMainSizes[idx]! + shareOfSpace;
          if (c._flexSized === undefined) c._flexBase = c[dimension] || 0;
          c[dimension] = c._flexSized = newMainSize;
          if (resized) resized[idx] = 1;
          childMainSizes[idx] = newMainSize;
          childTotalMainSizes[idx] =
            newMainSize + childMarginStarts[idx]! + childMarginEnds[idx]!;
        }
      }
      node._containsFlexGrow = node._containsFlexGrow ? null : true;
    } else if (availableSpace < 0 && totalFlexShrink > 0) {
      // Flex Shrink Phase
      let totalScaledShrinkFactor = 0;
      for (let idx = 0; idx < numProcessedChildren; idx++) {
        const c = children[processableChildrenIndices[idx]!] as ElementNode;
        const flexShrinkValue = c.flexShrink || 0;
        totalScaledShrinkFactor += flexShrinkValue * childMainSizes[idx]!;
      }

      if (totalScaledShrinkFactor > 0) {
        for (let idx = 0; idx < numProcessedChildren; idx++) {
          const c = children[processableChildrenIndices[idx]!] as ElementNode;
          const flexShrinkValue = c.flexShrink || 0;
          if (flexShrinkValue > 0) {
            const shrinkRatio =
              (flexShrinkValue * childMainSizes[idx]!) /
              totalScaledShrinkFactor;
            const sizeReduction = shrinkRatio * Math.abs(availableSpace);
            let newMainSize = childMainSizes[idx]! - sizeReduction;

            // Constrain by min width/height
            const minBound = c[minDimension] || 0;
            if (newMainSize < minBound) {
              newMainSize = minBound;
            }

            if (c._flexSized === undefined) c._flexBase = c[dimension] || 0;
            c[dimension] = c._flexSized = newMainSize;
            if (resized) resized[idx] = 1;
            childMainSizes[idx] = newMainSize;
            childTotalMainSizes[idx] =
              newMainSize + childMarginStarts[idx]! + childMarginEnds[idx]!;
          }
        }
      }
      node._containsFlexGrow = node._containsFlexGrow ? null : true;
    } else if (node._containsFlexGrow) {
      node._containsFlexGrow = null;
    } else if (isDev) {
      // No positive space available for items to grow, or items overflow.
      // flex-grow has no effect in this case.
      console.warn(
        'No available space for flex-grow items to expand, or items overflow.',
      );
    }
  }

  if (resized) {
    // A child sized by an earlier pass that got no share this time returns to
    // its own size.
    for (let idx = 0; idx < numProcessedChildren; idx++) {
      if (resized[idx]) continue;
      const c = children[processableChildrenIndices[idx]!] as ElementNode;
      if (c._flexSized === undefined) continue;
      c[dimension] = c._flexBase!;
      c._flexSized = c._flexBase = undefined;
    }
  }

  let totalItemSize = 0;
  if (
    justify === 'center' ||
    justify === 'spaceBetween' ||
    justify === 'spaceEvenly' ||
    justify === 'spaceAround'
  ) {
    for (let idx = 0; idx < numProcessedChildren; idx++) {
      totalItemSize += childTotalMainSizes[idx]!;
    }
  }

  // Places a child on the cross axis inside a line that starts at `lineStart`
  // and is `lineSize` deep.
  const alignInLine = (
    c: ElementNode,
    idx: number,
    lineStart: number,
    lineSize: number,
  ) => {
    const alignSelf = c.alignSelf || align;
    if (!alignSelf) {
      return;
    }
    if (alignSelf === 'flexStart') {
      c[crossProp] = lineStart + childMarginCrossStarts[idx]!;
    } else if (alignSelf === 'center') {
      c[crossProp] =
        lineStart +
        (lineSize - childCrossSizes[idx]!) / 2 +
        childMarginCrossStarts[idx]!;
    } else if (alignSelf === 'flexEnd') {
      c[crossProp] =
        lineStart +
        lineSize -
        childCrossSizes[idx]! -
        childMarginCrossEnds[idx]!;
    }
  };

  if (isRow && node._calcHeight && !node.flexCrossBoundary) {
    // The height fits the tallest child with its margins, inside the padding.
    let maxHeight = 0;
    for (let idx = 0; idx < numProcessedChildren; idx++) {
      const outer =
        childCrossSizes[idx]! +
        childMarginCrossStarts[idx]! +
        childMarginCrossEnds[idx]!;
      if (outer > maxHeight) maxHeight = outer;
    }
    // Children start below the top padding unless they are aligned otherwise.
    if (paddingCrossStart !== 0) align ??= 'flexStart';
    // Fit even when nothing is measured yet: an unmeasured text child leaves
    // the row zero-high instead of keeping the parent-derived height, so a
    // pointer cannot hit the wrong row while the texts load. The row is laid
    // out again from the `loaded` event.
    const newHeight = maxHeight + paddingCrossStart + paddingCrossEnd;
    if (newHeight !== node.height) {
      containerUpdated = true;
      node.height = containerCrossSize = newHeight;
    }
  }

  // Without wrapping there is one line: the padded box of the container. With
  // no cross size there is nothing to align against.
  const wraps = node.flexWrap === 'wrap' || isWrapReverse;
  const lineSize = containerCrossSize - paddingCrossStart - paddingCrossEnd;
  const doCrossAlign = containerCrossSize
    ? (c: ElementNode, idx: number) =>
        alignInLine(c, idx, paddingCrossStart, lineSize)
    : (_c: ElementNode, _idx: number) => {
        /* no-op */
      };

  let currentPos = paddingStart;
  if (justify === 'flexStart') {
    if (wraps) {
      // Every line is as deep as the first child.
      const wrapLineSize = childCrossSizes[0]!;
      const crossGap = isRow ? (node.columnGap ?? gap) : (node.rowGap ?? gap);
      const lineStep = wrapLineSize + crossGap;
      const lineOf = new Uint16Array(numProcessedChildren);
      let line = 0;

      for (let idx = 0; idx < numProcessedChildren; idx++) {
        const c = children[processableChildrenIndices[idx]!] as ElementNode;
        if (
          currentPos + childTotalMainSizes[idx]! > containerSize &&
          currentPos > paddingStart
        ) {
          currentPos = paddingStart;
          line++;
        }
        lineOf[idx] = line;
        c[prop] = currentPos + childMarginStarts[idx]!;
        currentPos += childTotalMainSizes[idx]! + gap;
      }

      // The container grows to hold every line. wrap-reverse stacks them from
      // the far edge of that grown box, so the first line is the last one.
      const finalCrossSize =
        paddingCrossStart + line * lineStep + wrapLineSize + paddingCrossEnd;
      for (let idx = 0; idx < numProcessedChildren; idx++) {
        const c = children[processableChildrenIndices[idx]!] as ElementNode;
        const placedLine = isWrapReverse ? line - lineOf[idx]! : lineOf[idx]!;
        alignInLine(
          c,
          idx,
          paddingCrossStart + placedLine * lineStep,
          wrapLineSize,
        );
      }

      if (node[crossDimension] !== finalCrossSize) {
        node[`preFlex${crossDimension}`] = node[crossDimension];
        node[crossDimension] = finalCrossSize;
        containerUpdated = true;
      }
    } else {
      for (let idx = 0; idx < numProcessedChildren; idx++) {
        const c = children[processableChildrenIndices[idx]!] as ElementNode;
        c[prop] = currentPos + childMarginStarts[idx]!;
        currentPos += childTotalMainSizes[idx]! + gap;
        doCrossAlign(c, idx);
      }
    }

    // Update container size
    if (node.flexBoundary !== 'fixed' && !wraps) {
      let calculatedSize = currentPos - gap + paddingEnd;
      const minSize = node[minDimension] || 0;
      if (calculatedSize < minSize) {
        calculatedSize = minSize;
      }
      if (calculatedSize !== (node[dimension] || 0)) {
        node[`preFlex${dimension}`] = containerSize;
        node[dimension] = calculatedSize;
        return true;
      }
    }
  } else if (justify === 'flexEnd') {
    currentPos = containerSize - paddingEnd;
    for (let idx = numProcessedChildren - 1; idx >= 0; idx--) {
      const c = children[processableChildrenIndices[idx]!] as ElementNode;
      c[prop] = currentPos - childMainSizes[idx]! - childMarginEnds[idx]!;
      currentPos -= childTotalMainSizes[idx]! + gap;
      doCrossAlign(c, idx);
    }
  } else if (justify === 'center') {
    // Centered in the padded box.
    currentPos =
      paddingStart +
      (containerSize -
        nodePaddingTotal -
        (totalItemSize + gap * (numProcessedChildren - 1))) /
        2;
    for (let idx = 0; idx < numProcessedChildren; idx++) {
      const c = children[processableChildrenIndices[idx]!] as ElementNode;
      c[prop] = currentPos + childMarginStarts[idx]!;
      currentPos += childTotalMainSizes[idx]! + gap;
      doCrossAlign(c, idx);
    }
  } else if (justify === 'spaceBetween') {
    const spaceBetween =
      numProcessedChildren > 1
        ? (containerSize - totalItemSize - nodePaddingTotal) /
          (numProcessedChildren - 1)
        : 0;
    currentPos = paddingStart;
    for (let idx = 0; idx < numProcessedChildren; idx++) {
      const c = children[processableChildrenIndices[idx]!] as ElementNode;
      c[prop] = currentPos + childMarginStarts[idx]!;
      currentPos += childTotalMainSizes[idx]! + spaceBetween;
      doCrossAlign(c, idx);
    }
  } else if (justify === 'spaceAround') {
    const spaceAround =
      numProcessedChildren > 0
        ? (containerSize - totalItemSize - nodePaddingTotal) /
          numProcessedChildren
        : 0;
    currentPos = paddingStart + spaceAround / 2;
    for (let idx = 0; idx < numProcessedChildren; idx++) {
      const c = children[processableChildrenIndices[idx]!] as ElementNode;
      c[prop] = currentPos + childMarginStarts[idx]!;
      currentPos += childTotalMainSizes[idx]! + spaceAround;
      doCrossAlign(c, idx);
    }
  } else if (justify === 'spaceEvenly') {
    const spaceEvenly =
      (containerSize - totalItemSize - nodePaddingTotal) /
      (numProcessedChildren + 1);
    currentPos = spaceEvenly + paddingStart;
    for (let idx = 0; idx < numProcessedChildren; idx++) {
      const c = children[processableChildrenIndices[idx]!] as ElementNode;
      c[prop] = currentPos + childMarginStarts[idx]!;
      currentPos += childTotalMainSizes[idx]! + spaceEvenly;
      doCrossAlign(c, idx);
    }
  }

  return containerUpdated;
}
