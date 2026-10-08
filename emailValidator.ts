
import validator from 'validator'; // Assuming 'validator.js' is installed: npm install validator @types/validator

/**
 * Validates an email address using a combination of regular expressions and
 * a robust external library ('validator.js').
 *
 * This function first performs a basic check with a regular expression for common
 * email format patterns, which is useful for quick client-side validation.
 * For more comprehensive and standard-compliant validation, it then leverages
 * the 'validator.js' library.
 *
 * @param email The email address string to validate.
 * @returns true if the email is valid, false otherwise.
 */
export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  // Step 1: Initial pragmatic regular expression validation.
  // This regex checks for a basic email structure (e.g., user@domain.com).
  // It's not exhaustive but catches
  //  many common typos and invalid formats quickly.
  // A more comprehensive regex can be found, but it often becomes too complex and might reject valid emails.
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!regex.test(email)) {
    console.log(`Initial regex validation failed for: ${email}`);
    return false;
  }

  // Step 2: Comprehensive validation using an external library (validator.js).
  // 'validator.js' provides a battle-tested and regularly updated set of email validation rules
  // that comply with various RFCs and common email practices.
  const isValidByLibrary = validator.isEmail(email);

  if (!isValidByLibrary) {
    console.log(`Validator.js validation failed for: ${email}`);
  }

  return isValidByLibrary;
}

// --- Example Usage ---
console.log('--- Email Validation Examples ---');

const testEmails = [
  'test@example.com',           // Valid
  'john.doe@sub.domain.co.uk',  // Valid
  'invalid-email',              // Invalid (no @)
  'user@.com',                  // Invalid (domain starts with .)
  'user@domain',                // Invalid (no top-level domain)
  'user@domain..com',           // Invalid (double dot in domain)
  'another@example.com',        // Valid
  'user@localhost',             // Valid in some contexts, but validator.js might flag it depending on strictness
  '123@123.123.123.123',        // Valid IP address domain
  '',                           // Invalid (empty string)
  null as any,                  // Invalid (null)
  undefined as any,             // Invalid (undefined)
];

testEmails.forEach(email => {
  const result = validateEmail(email);
  console.log(`"${email}" is ${result ? 'VALID' : 'INVALID'}`);
});
