export const missingServiceSearchFields = [
  "serviceCategory",
  "location",
  "desiredDate",
  "desiredTimeWindow",
] as const;

export type MissingServiceSearchField = (typeof missingServiceSearchFields)[number];

export type ServiceSearchInputs = {
  serviceCategory?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  desiredDate?: string;
  desiredTimeWindow?: string;
};

export function hasUsableServiceLocation(input: Pick<ServiceSearchInputs, "city" | "region" | "postalCode">) {
  const usablePostalCode = input.postalCode?.trim() && /^\d{5}$/.test(input.postalCode.trim());
  return Boolean(usablePostalCode || (input.city?.trim() && input.region?.trim()));
}

export function missingRequiredServiceSearchInputs(input: ServiceSearchInputs): MissingServiceSearchField[] {
  const missing: MissingServiceSearchField[] = [];
  if (!input.serviceCategory?.trim()) missing.push("serviceCategory");
  if (!hasUsableServiceLocation(input)) missing.push("location");
  if (!input.desiredDate?.trim()) missing.push("desiredDate");
  if (!input.desiredTimeWindow?.trim()) missing.push("desiredTimeWindow");
  return missing;
}

export function clarificationQuestion(missing: MissingServiceSearchField[]) {
  const questions = missing.flatMap((field) => {
    switch (field) {
      case "serviceCategory": return ["What type of service should I search for (for example, plumbing or furniture assembly)?"];
      case "location": return ["What city and state/region or 5-digit postal code should I use?"];
      case "desiredDate": return ["What date should the provider visit?"];
      case "desiredTimeWindow": return ["What time window works that day?"];
    }
  });
  return questions.join(" ");
}
