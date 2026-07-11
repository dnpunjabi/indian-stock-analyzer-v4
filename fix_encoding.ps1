$file = "c:\Users\dheer\Desktop\AI\indian-stock-analyzer - 3.0\backend\static\app.js"

# Read the file as bytes and convert with UTF-8
$content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

# Fix the corrupted unicode characters
# The warning symbol ⚠ (U+26A0) got corrupted, and em-dash — (U+2014) got corrupted
# We need to replace the corrupted sequences

# Find and replace the corrupted addFlag line
$oldLine1 = "addFlag('fixed assets', 'warning', '"
$idx = $content.IndexOf($oldLine1)
Write-Host "Found addFlag at position: $idx"

if ($idx -gt 0) {
    # Find the end of this statement (the closing semicolon + newline)
    $endIdx = $content.IndexOf("risk`);", $idx)
    if ($endIdx -gt 0) {
        $endIdx = $endIdx + "risk`);".Length
        $oldSnippet = $content.Substring($idx, $endIdx - $idx)
        Write-Host "Old snippet: $oldSnippet"
        
        $newSnippet = "addFlag('fixed assets', 'warning', '`u{26A0} Low Asset Utilization',`r`n                ``Fixed assets grew `${(faGrowth * 100).toFixed(0)}% but sales only `${(sGrowth * 100).toFixed(0)}% `u{2014} capacity underutilization risk``)"
        
        Write-Host "Replacing..."
        $content = $content.Remove($idx, $endIdx - $idx).Insert($idx, $newSnippet)
        
        [System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::UTF8)
        Write-Host "Done!"
    } else {
        Write-Host "Could not find end of statement"
    }
} else {
    Write-Host "Could not find addFlag line"
}
