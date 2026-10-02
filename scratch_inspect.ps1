$extractPath = "C:\Users\Vinh-NH\.gemini\antigravity\scratch\extracted_xlsx"
$ssPath = "$extractPath\xl\sharedStrings.xml"
$sharedStrings = @()
if (Test-Path $ssPath) {
    $reader = [System.Xml.XmlReader]::Create($ssPath)
    while ($reader.Read()) {
        if ($reader.NodeType -eq [System.Xml.XmlNodeType]::Element -and $reader.Name -eq "t") {
            $sharedStrings += $reader.ReadElementContentAsString()
        }
    }
    $reader.Close()
}

function ColLetterToIdx($colStr) {
    $idx = 0
    for ($i = 0; $i -lt $colStr.Length; $i++) {
        $idx = $idx * 26 + ([int]$colStr[$i] - [int][char]'A' + 1)
    }
    return $idx - 1
}

function ParseCellRef($ref) {
    if ($ref -match '^([A-Z]+)([0-9]+)$') {
        return @{
            col = ColLetterToIdx($Matches[1])
            row = [int]$Matches[2] - 1
        }
    }
    return $null
}

$sheetXml = "$extractPath\xl\worksheets\sheet12.xml"
$reader = [System.Xml.XmlReader]::Create($sheetXml)
$rows = @{}

while ($reader.Read()) {
    if ($reader.NodeType -eq [System.Xml.XmlNodeType]::Element) {
        if ($reader.Name -eq "c") {
            $cellRef = $reader.GetAttribute("r")
            $cellType = $reader.GetAttribute("t")
        } elseif ($reader.Name -eq "v") {
            $val = $reader.ReadElementContentAsString()
            $parsed = ParseCellRef $cellRef
            if ($parsed -and $parsed.row -ge 3) {
                $rowIdx = $parsed.row
                $colIdx = $parsed.col
                if (!$rows[$rowIdx]) { $rows[$rowIdx] = @{} }
                
                $finalVal = ""
                if ($cellType -eq "s") {
                    $strIdx = [int]$val
                    if ($strIdx -ge 0 -and $strIdx -lt $sharedStrings.Count) {
                        $finalVal = $sharedStrings[$strIdx]
                    }
                } else {
                    $finalVal = $val
                }
                $rows[$rowIdx][$colIdx] = $finalVal
            }
        }
    }
}
$reader.Close()

$col2Values = @{}
$col1Values = @{}

foreach ($r in $rows.Keys) {
    $row = $rows[$r]
    $val2 = $row[2]
    $val1 = $row[1]
    if ($val2) { $col2Values[$val2] = [int]($col2Values[$val2]) + 1 }
    if ($val1) { $col1Values[$val1] = [int]($col1Values[$val1]) + 1 }
}

Write-Host "Unique values of index 2 (Col C):"
$col2Values.Keys | ForEach-Object { "$_ : $($col2Values[$_])" }

Write-Host "`nUnique values of index 1 (Col B):"
$col1Values.Keys | Select-Object -First 20 | ForEach-Object { "$_ : $($col1Values[$_])" }
