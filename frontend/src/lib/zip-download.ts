export type ZipFile = {
  name: string
  data: Uint8Array
}

const encoder = new TextEncoder()

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function write16(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff)
}

function write32(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

function append(target: number[], value: Uint8Array) {
  for (const byte of value) target.push(byte)
}

function uniqueNames(files: ZipFile[]) {
  const used = new Map<string, number>()
  return files.map((file) => {
    const dot = file.name.lastIndexOf(".")
    const stem = dot > 0 ? file.name.slice(0, dot) : file.name
    const extension = dot > 0 ? file.name.slice(dot) : ""
    const count = (used.get(file.name.toLowerCase()) || 0) + 1
    used.set(file.name.toLowerCase(), count)
    return { ...file, name: count === 1 ? file.name : `${stem}_${count}${extension}` }
  })
}

export function createZip(files: ZipFile[]) {
  const local: number[] = []
  const central: number[] = []

  for (const file of uniqueNames(files)) {
    const name = encoder.encode(file.name)
    const checksum = crc32(file.data)
    const offset = local.length

    write32(local, 0x04034b50)
    write16(local, 20)
    write16(local, 0x0800)
    write16(local, 0)
    write16(local, 0)
    write16(local, 0)
    write32(local, checksum)
    write32(local, file.data.length)
    write32(local, file.data.length)
    write16(local, name.length)
    write16(local, 0)
    append(local, name)
    append(local, file.data)

    write32(central, 0x02014b50)
    write16(central, 20)
    write16(central, 20)
    write16(central, 0x0800)
    write16(central, 0)
    write16(central, 0)
    write16(central, 0)
    write32(central, checksum)
    write32(central, file.data.length)
    write32(central, file.data.length)
    write16(central, name.length)
    write16(central, 0)
    write16(central, 0)
    write16(central, 0)
    write16(central, 0)
    write32(central, 0)
    write32(central, offset)
    append(central, name)
  }

  const result = [...local, ...central]
  write32(result, 0x06054b50)
  write16(result, 0)
  write16(result, 0)
  write16(result, files.length)
  write16(result, files.length)
  write32(result, central.length)
  write32(result, local.length)
  write16(result, 0)
  return new Uint8Array(result)
}

export function downloadZip(files: ZipFile[], archiveName: string) {
  if (!files.length) throw new Error("There are no PDF files to download.")
  const zip = createZip(files)
  const bytes = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }))
  const link = document.createElement("a")
  link.href = url
  link.download = archiveName.endsWith(".zip") ? archiveName : `${archiveName}.zip`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
