export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const invalid = (message: string) => new ApiError(400, 'INVALID_INPUT', message);
export const notFound = () => new ApiError(404, 'NOT_FOUND', 'Resource not found or access is not permitted.');
