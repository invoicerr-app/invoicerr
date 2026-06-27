export function formatSiret(siret: string): string {
    return siret.replace(/[^0-9]/g, '');
}

export function isValidSiret(siret: string): boolean {
    const formatted = formatSiret(siret);
    if (formatted.length !== 14) return false;

    let sum = 0;
    for (let i = 0; i < formatted.length; i++) {
        let digit = parseInt(formatted[i], 10);
        if (i % 2 === 0) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
    }
    return sum % 10 === 0;
}

export function extractSirenFromSiret(siret: string): string {
    return formatSiret(siret).slice(0, 9);
}

export function calculateFrenchVAT(siren: string): string {
    const key = (12 + 3 * (parseInt(siren, 10) % 97)) % 97;
    return `FR${key.toString().padStart(2, '0')}${siren}`;
}
