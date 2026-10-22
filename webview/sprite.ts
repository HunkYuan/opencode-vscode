const inserted = new Set<string>()

export function inlineSprite(source: string, id: string) {
  if (inserted.has(id)) return ""
  const svg = new DOMParser().parseFromString(source, "image/svg+xml").documentElement
  svg.id = id
  svg.setAttribute("aria-hidden", "true")
  svg.setAttribute("width", "0")
  svg.setAttribute("height", "0")
  svg.style.position = "absolute"
  svg.style.overflow = "hidden"
  document.body.appendChild(document.importNode(svg, true))
  inserted.add(id)
  return ""
}
