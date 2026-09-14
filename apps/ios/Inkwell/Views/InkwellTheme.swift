import SwiftUI
import UIKit

enum InkwellTheme {
    static let paper = adaptive(0xF5F3EE, 0x17181A)
    static let leaf = adaptive(0xFCFBF7, 0x1E2022)
    static let ink = adaptive(0x172A3E, 0xE7E9EC)
    static let secondary = adaptive(0x526576, 0xA4ABB4)
    static let muted = adaptive(0x7B8995, 0x737A84)
    static let accent = adaptive(0x1F5B8B, 0x6FA3DC)
    static let hairline = adaptive(0xD9D9D3, 0x2B2E32)
    static let mist = adaptive(0xE8EFF3, 0x1E2C3D)

    static func serif(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom(weight == .bold ? "Georgia-Bold" : "Georgia", size: size, relativeTo: .body)
    }

    private static func adaptive(_ light: UInt, _ dark: UInt) -> Color {
        Color(uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((value >> 16) & 255) / 255,
                           green: CGFloat((value >> 8) & 255) / 255,
                           blue: CGFloat(value & 255) / 255, alpha: 1)
        })
    }
}
