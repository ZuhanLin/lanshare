import qrcode from 'qrcode-terminal'

export function renderQR(url: string): Promise<string> {
  return new Promise((resolve) => {
    qrcode.generate(url, { small: true }, (output) => {
      resolve(output)
    })
  })
}
