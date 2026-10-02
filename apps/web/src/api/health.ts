/** Liveness probe. The app uses it to tell "backend is down" from "backend says no data". */

import type { components } from '../../../../contracts/api.d.ts'
import { getJson, type RequestOptions } from './client.ts'

type HealthDto = components['schemas']['Health']

export async function fetchHealth(options: RequestOptions = {}): Promise<boolean> {
  const dto = (await getJson('/health', options)) as HealthDto
  return dto.status === 'ok'
}
