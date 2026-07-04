const ZERO_ALPHA_EPSILON = 1e-6;

function alphaAt(attribute, index) {
  const value = typeof attribute.getW === "function"
    ? attribute.getW(index)
    : attribute.array?.[index * attribute.itemSize + 3];

  return Number.isFinite(value) ? value : 0;
}

export function describeVertexColorAlpha(attribute) {
  if (!attribute || attribute.itemSize < 4 || !Number.isFinite(attribute.count)) {
    return {
      hasAlpha: false,
      count: 0,
      minAlpha: null,
      maxAlpha: null,
      allAlphaZero: false,
    };
  }

  const count = Math.max(0, Math.floor(attribute.count));
  if (count === 0) {
    return {
      hasAlpha: true,
      count,
      minAlpha: null,
      maxAlpha: null,
      allAlphaZero: false,
    };
  }

  let minAlpha = Infinity;
  let maxAlpha = -Infinity;

  for (let index = 0; index < count; index += 1) {
    const alpha = alphaAt(attribute, index);
    minAlpha = Math.min(minAlpha, alpha);
    maxAlpha = Math.max(maxAlpha, alpha);
  }

  return {
    hasAlpha: true,
    count,
    minAlpha,
    maxAlpha,
    allAlphaZero: maxAlpha <= ZERO_ALPHA_EPSILON,
  };
}

function normalizeMaterials(material) {
  if (Array.isArray(material)) {
    return material;
  }

  return material ? [material] : [];
}

export function sanitizeZeroAlphaVertexColors(root) {
  const result = {
    meshesChecked: 0,
    sanitizedMeshes: 0,
    sanitizedMaterials: 0,
    sanitizedMeshNames: [],
  };

  if (!root || typeof root.traverse !== "function") {
    return result;
  }

  root.traverse((object) => {
    if (!object?.isMesh) {
      return;
    }

    const colorAttribute = object.geometry?.attributes?.color;
    const alphaDescription = describeVertexColorAlpha(colorAttribute);
    if (!alphaDescription.hasAlpha) {
      return;
    }

    result.meshesChecked += 1;
    if (!alphaDescription.allAlphaZero) {
      return;
    }

    let sanitizedMaterialCount = 0;
    for (const material of normalizeMaterials(object.material)) {
      if (material && material.vertexColors !== false) {
        material.vertexColors = false;
        material.needsUpdate = true;
        sanitizedMaterialCount += 1;
      }
    }

    if (sanitizedMaterialCount > 0) {
      result.sanitizedMeshes += 1;
      result.sanitizedMaterials += sanitizedMaterialCount;
      result.sanitizedMeshNames.push(object.name || "(unnamed mesh)");
    }
  });

  return result;
}
