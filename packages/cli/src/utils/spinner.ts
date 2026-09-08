import * as oraModule from 'ora'

const oraImport = oraModule.default as typeof oraModule.default & {
  default?: typeof oraModule.default
}
const ora = oraImport.default ?? oraImport

export const spinner = ora({
  spinner: 'clock',
})

export const spinnerFunc =()=>ora({
  spinner: 'clock',
})
