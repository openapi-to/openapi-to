import type { OperationWrapper } from '@openapi-to/core'
import { head } from 'lodash-es'
import type { OptionalKind, ParameterDeclarationStructure } from 'ts-morph'
import { type PluginConfig, RequestClientEnum } from '../types.ts'

export function buildMethodParameters(operation: OperationWrapper, pluginConfig?: PluginConfig): OptionalKind<ParameterDeclarationStructure>[] {
  const axiosRequestConfigType = `Partial<AxiosRequestConfig${operation.accessor.hasRequestBody ? `<${operation.accessor.operationTSType?.body || ''}>` : ''}>`
  const requestConfigNamedImports = head(pluginConfig?.requestConfigTypeImportDeclaration?.namedImports)

  const commonRequestConfigType = requestConfigNamedImports ? `Partial<${requestConfigNamedImports}>` : 'unknown'

  const requestConfig = {
    name: 'requestConfig',
    hasQuestionToken: true,
    type: pluginConfig?.requestClient === RequestClientEnum.FETCH ? 'FetchRequestConfig' : pluginConfig?.requestClient === RequestClientEnum.COMMON ? commonRequestConfigType : axiosRequestConfigType,
  }
  return [
    {
      name: 'input',
      type: operation.accessor.operationTSType?.requestInput,
      ...(operation.accessor.isRequestInputOptional ? { initializer: '{}' } : {}),
    },
    requestConfig,
  ]
}
